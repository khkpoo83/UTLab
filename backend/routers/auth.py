import asyncio
import logging
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import User, get_db, AsyncSessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

SECRET_KEY = ""  # 반드시 환경변수 JWT_SECRET으로 설정 — configure()에서 주입
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440

# 초기 사용자 생성에만 사용 — 이후 인증은 DB hash 기준
_init_username: str = "admin"
_init_password: str = ""   # configure()에서 채워짐, 이후 메모리에서 삭제

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def configure(secret_key: str, expire_minutes: int, username: str, password: str) -> None:
    global SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES, _init_username, _init_password
    SECRET_KEY = secret_key
    ACCESS_TOKEN_EXPIRE_MINUTES = expire_minutes
    _init_username = username
    _init_password = password


async def ensure_initial_user() -> None:
    """앱 시작 시 DB에 사용자가 없으면 초기 비밀번호로 1회 생성 후 메모리에서 삭제."""
    global _init_password
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == _init_username))
        user = result.scalar_one_or_none()
        if not user:
            if not _init_password:
                raise RuntimeError("APP_PASSWORD 환경변수가 설정되지 않았습니다.")
            hashed = await asyncio.get_event_loop().run_in_executor(
                None, pwd_context.hash, _init_password
            )
            session.add(User(username=_init_username, hashed_password=hashed))
            await session.commit()
            logger.info(f"초기 사용자 생성 완료: {_init_username}")
    # 메모리에서 평문 비밀번호 즉시 제거
    _init_password = ""


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    if not SECRET_KEY:
        raise RuntimeError("JWT SECRET_KEY가 설정되지 않았습니다.")
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


# CurrentUser 타입 별칭
CurrentUser = Annotated[User, Depends(get_current_user)]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class UserResponse(BaseModel):
    id: int
    username: str


@router.post("/login", response_model=TokenResponse)
async def login(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]) -> TokenResponse:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == form_data.username))
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        # 계정 잠금 확인
        if user.locked_until and user.locked_until > datetime.utcnow():
            remaining = int((user.locked_until - datetime.utcnow()).total_seconds() / 60)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Account locked. Try again in {remaining} minutes.",
            )

        # DB hash로만 검증 — 평문 비교 없음
        valid = await asyncio.get_event_loop().run_in_executor(
            None, pwd_context.verify, form_data.password, user.hashed_password
        )
        if not valid:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= MAX_FAILED_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_attempts = 0
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        user.failed_attempts = 0
        user.locked_until = None
        await session.commit()

    token = create_access_token(
        data={"sub": form_data.username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return TokenResponse(access_token=token, token_type="bearer")


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    return UserResponse(id=current_user.id, username=current_user.username)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.put("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """현재 비밀번호 확인 후 새 비밀번호를 bcrypt 해시로 DB 저장."""
    if len(data.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="새 비밀번호는 8자 이상이어야 합니다.",
        )

    valid = await asyncio.get_event_loop().run_in_executor(
        None, pwd_context.verify, data.current_password, current_user.hashed_password
    )
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 비밀번호가 올바르지 않습니다.",
        )

    new_hashed = await asyncio.get_event_loop().run_in_executor(
        None, pwd_context.hash, data.new_password
    )

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == current_user.id))
        user = result.scalar_one()
        user.hashed_password = new_hashed
        await session.commit()

    return {"message": "비밀번호가 변경되었습니다."}
