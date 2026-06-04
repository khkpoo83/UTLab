from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, JSON, Index,
    ForeignKey, event
)
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool

DATABASE_URL = "sqlite+aiosqlite:///./data/utlab.db"

engine = create_async_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    hashed_password = Column(String(256), nullable=False)
    failed_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Account(Base):
    __tablename__ = "account"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), nullable=False)
    color = Column(String(16), nullable=False, default="#3B82F6", server_default="#3B82F6")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Portfolio(Base):
    __tablename__ = "portfolio"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    exchange = Column(String(32), nullable=True)
    avg_price = Column(Float, nullable=False)
    quantity = Column(Float, nullable=False)
    memo = Column(Text, nullable=True)
    bought_at = Column(DateTime, nullable=True)
    sector = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # Kiwoom 연동 대비 필드 (수동 등록 시 기본값 'manual')
    source = Column(String(20), default="manual", nullable=False, server_default="manual")
    account_no = Column(String(32), nullable=True)   # 키움 계좌번호
    external_id = Column(String(64), nullable=True)  # 키움 포지션 ID (upsert 키)
    account_id = Column(Integer, nullable=True)       # 사용자 정의 계좌 ID


class StockPrice(Base):
    __tablename__ = "stock_price"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False)
    date = Column(DateTime, nullable=False)
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    is_summary = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        Index("ix_stock_price_ticker_date", "ticker", "date"),
    )


class MarketIndex(Base):
    __tablename__ = "market_index"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(64), nullable=False)
    price = Column(Float, nullable=True)
    change = Column(Float, nullable=True)
    change_pct = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class News(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(512), nullable=False)
    url = Column(String(1024), nullable=False)
    url_hash = Column(String(64), unique=True, nullable=False, index=True)
    source = Column(String(64), nullable=True)
    published_at = Column(DateTime, nullable=True, index=True)
    description = Column(Text, nullable=True)   # RSS 원문 요약 (AI 입력용)
    summary = Column(Text, nullable=True)
    sector = Column(String(64), nullable=True)
    related_stocks = Column(JSON, nullable=True)
    group_id = Column(String(64), nullable=True, index=True)
    status = Column(String(20), default="pending", nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Recommendation(Base):
    __tablename__ = "recommendation"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    sector = Column(String(64), nullable=True)
    sector_weight = Column(Float, nullable=True)
    news_count = Column(Integer, default=0)
    latest_price = Column(Float, nullable=True)
    change_pct = Column(Float, nullable=True)
    strength = Column(String(20), nullable=True)
    reason = Column(Text, nullable=True)                    # AI 추천 이유 (2-3문장)
    confidence = Column(String(20), nullable=True)          # high / medium
    ai_session = Column(String(20), nullable=True)          # morning / evening
    entry_price = Column(Float, nullable=True)              # 추천 진입가
    entry_range_low = Column(Float, nullable=True)          # 진입 구간 하단
    entry_range_high = Column(Float, nullable=True)         # 진입 구간 상단
    target_price = Column(Float, nullable=True)             # 목표가
    target_return_pct = Column(Float, nullable=True)        # 목표 수익률 %
    stop_loss_price = Column(Float, nullable=True)          # 손절가
    stop_loss_pct = Column(Float, nullable=True)            # 손절 %
    technical_summary = Column(Text, nullable=True)         # 기술적 분석 요약
    generated_at = Column(DateTime, nullable=True)          # AI 생성 시각
    community_sentiment = Column(Text, nullable=True)       # 커뮤니티 반응 요약
    political_theme = Column(String(20), nullable=True)     # "ruling" | "opposition" | "common" | None
    political_weight = Column(Float, nullable=True)         # 정치 가중치 (0.5~2.0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class StockMaster(Base):
    __tablename__ = "stock_master"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False, index=True)
    exchange = Column(String(20), nullable=False)   # KOSPI, KOSDAQ, KONEX, ETF, NASDAQ, NYSE
    market = Column(String(10), nullable=False, default="KR")  # KR, US
    industry = Column(String(100), nullable=True)   # 업종명 (네이버 분류)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_stock_master_name", "name"),
    )


class PortfolioSnapshot(Base):
    """포트폴리오 일별 스냅샷 - 장기 수익률 트렌드용"""
    __tablename__ = "portfolio_snapshot"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, nullable=False, index=True)    # 날짜 (KST 기준 당일)
    account_no = Column(String(32), nullable=False, server_default='TOTAL')  # 'TOTAL'=전체, KIS계좌번호=계좌별
    total_value = Column(Float, nullable=False)    # 총 평가액
    total_cost = Column(Float, nullable=False)     # 총 투자금
    pnl = Column(Float, nullable=False)            # 미실현 손익 (원)
    pnl_pct = Column(Float, nullable=False)        # 수익률 (%)
    realized_pnl = Column(Float, nullable=False, server_default='0')  # 누적 실현 손익 (원)
    cash_balance = Column(Float, nullable=False, server_default='0')  # 예수금 (d2_entra)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("uq_portfolio_snapshot_date_acct", "date", "account_no", unique=True),
    )


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(64), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class UserProfile(Base):
    """사용자 개인 프로필 — 은퇴 플래너 등에 자동 연동"""
    __tablename__ = "user_profile"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    display_name = Column(String(64), nullable=True)          # 표시 이름
    birth_date = Column(String(10), nullable=True)             # "YYYY-MM-DD"
    profile_icon = Column(String(8), nullable=True, default="👤")  # 이모지
    job = Column(String(64), nullable=True)                    # 직업
    retire_age = Column(Integer, nullable=True, default=60)    # 목표 은퇴 나이
    monthly_income_만 = Column(Integer, nullable=True)         # 월 소득 (만원)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CalendarToken(Base):
    """Google Calendar OAuth2 토큰 — 암호화 저장"""
    __tablename__ = "calendar_token"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    google_email = Column(String(256), nullable=True)          # 연동된 구글 계정
    encrypted_access_token = Column(Text, nullable=False)
    encrypted_refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)             # access token 만료시각 (UTC)
    calendar_id = Column(String(256), nullable=False, default="primary")
    sync_token = Column(Text, nullable=True)                   # primary 캘린더 syncToken (하위 호환)
    sync_tokens_json = Column(Text, nullable=True)             # JSON dict: {calendar_id: syncToken} 캘린더별 토큰
    calendars_json = Column(Text, nullable=True)               # JSON list of user's Google Calendars
    connected_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CalendarEvent(Base):
    """Google Calendar 이벤트 캐시"""
    __tablename__ = "calendar_event"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    google_event_id = Column(String(256), nullable=False, index=True)
    calendar_id = Column(String(256), nullable=False, default="primary")
    summary = Column(String(512), nullable=True)               # 제목
    description = Column(Text, nullable=True)
    location = Column(String(512), nullable=True)
    start_dt = Column(DateTime, nullable=True, index=True)     # 시작 (UTC)
    end_dt = Column(DateTime, nullable=True)                   # 종료 (UTC)
    all_day = Column(Boolean, default=False, nullable=False)   # 종일 이벤트
    recurrence = Column(Text, nullable=True)                   # 반복 규칙 (JSON)
    status = Column(String(20), default="confirmed")           # confirmed/tentative/cancelled
    html_link = Column(String(1024), nullable=True)
    color_id = Column(String(16), nullable=True)
    raw_json = Column(Text, nullable=True)                     # 원본 JSON 보관
    synced_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_calendar_event_user_google", "user_id", "google_event_id", unique=True),
        Index("ix_calendar_event_start", "user_id", "start_dt"),
    )


class CalendarWatchChannel(Base):
    """Google Calendar Push Notification 채널"""
    __tablename__ = "calendar_watch_channel"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    channel_id = Column(String(256), unique=True, nullable=False)  # UUID, 구글이 검증에 사용
    resource_id = Column(String(256), nullable=True)               # 구글이 발급하는 리소스 ID
    calendar_id = Column(String(256), nullable=False, default="primary")
    expiration = Column(DateTime, nullable=True)                   # 채널 만료 (UTC)
    webhook_token = Column(String(64), nullable=True)              # Webhook 수신 시 검증용 토큰
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class StockMeta(Base):
    """Stock metadata cache: name, sector, market_cap from external sources."""
    __tablename__ = "stock_meta"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=True)
    sector = Column(String(100), nullable=True)
    market_cap = Column(Float, nullable=True)
    last_updated = Column(DateTime, default=datetime.utcnow, nullable=False)


class PoliticalThemeStock(Base):
    """정치테마 종목 매핑 - 여당/야당/공통 수혜주 분류"""
    __tablename__ = "political_theme_stock"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    party_affiliation = Column(String(20), nullable=False)  # "ruling" | "opposition" | "common"
    theme_reason = Column(Text, nullable=True)   # 테마 분류 근거
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PoliticalCalendar(Base):
    """정치 일정 캘린더 - 선거, 예산, 주요 법안 등"""
    __tablename__ = "political_calendar"

    id = Column(Integer, primary_key=True, index=True)
    event_date = Column(DateTime, nullable=False, index=True)
    event_type = Column(String(50), nullable=False)   # "election_presidential" | "election_general" | "election_local" | "budget" | "legislation"
    title = Column(String(256), nullable=False)
    description = Column(Text, nullable=True)
    impact_level = Column(String(20), default="medium")  # "high" | "medium" | "low"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApprovalRating(Base):
    """정당/대통령 지지율 시계열"""
    __tablename__ = "approval_rating"

    id = Column(Integer, primary_key=True, index=True)
    survey_date = Column(DateTime, nullable=False, index=True)
    source = Column(String(64), nullable=False)   # "gallup" | "realmeter"
    ruling_party_pct = Column(Float, nullable=True)
    opposition_party_pct = Column(Float, nullable=True)
    president_approval_pct = Column(Float, nullable=True)
    raw_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class InvestmentMark(Base):
    """포트폴리오 차트 이벤트 마커 — 수익률 그래프에 날짜별 투자 이벤트 표기"""
    __tablename__ = "investment_mark"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), nullable=False, index=True)      # "YYYY-MM-DD" KST
    title = Column(String(256), nullable=False)
    google_event_id = Column(String(256), nullable=True, unique=True)   # GCal 이벤트 ID
    google_calendar_id = Column(String(256), nullable=True)             # GCal 캘린더 ID
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class DepositEvent(Base):
    """KIS 자동 수집 입출금 내역 (kt00015)"""
    __tablename__ = "deposit_event"

    id = Column(Integer, primary_key=True, index=True)
    account_no = Column(String(20), nullable=False, index=True)
    date = Column(String(10), nullable=False, index=True)   # "YYYY-MM-DD"
    trde_no = Column(String(40), nullable=True)             # 거래번호 (dedup key)
    amount = Column(Float, nullable=False)                  # 양수=입금, 음수=출금
    remark = Column(String(200), nullable=True)             # 적요명
    balance_after = Column(Float, nullable=True)            # 거래 후 예수금잔고
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class InvestmentEvent(Base):
    """투자 이벤트 — 매수/매도/입금/출금 수동 기록"""
    __tablename__ = "investment_event"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(20), nullable=False, index=True)  # buy | sell | deposit | withdraw
    event_date = Column(String(10), nullable=False, index=True)  # "YYYY-MM-DD" KST
    ticker = Column(String(20), nullable=True)
    name = Column(String(128), nullable=True)
    price = Column(Float, nullable=True)       # 체결가
    quantity = Column(Float, nullable=True)    # 수량
    amount = Column(Float, nullable=True)      # 총금액
    pnl = Column(Float, nullable=True)         # 손익 (매도 시)
    pnl_pct = Column(Float, nullable=True)     # 손익률 (매도 시)
    account_no = Column(String(32), nullable=True)  # 매도 계좌번호 (per-account R 귀속)
    note = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class InvestmentDiary(Base):
    """AI 투자 일기 — 하루 1개, 새벽에 자동 생성"""
    __tablename__ = "investment_diary"

    id = Column(Integer, primary_key=True, index=True)
    diary_date = Column(String(10), unique=True, nullable=False, index=True)  # "YYYY-MM-DD" KST
    content = Column(Text, nullable=False)      # AI 생성 일기 (3-4문장)
    raw_data = Column(Text, nullable=True)      # JSON — 생성에 사용된 데이터 스냅샷
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AiCycleState(Base):
    """AI 추천 R1→R2→R3 단계 간 중간 상태 저장 (10분 간격 분리 실행용)"""
    __tablename__ = "ai_cycle_state"

    id = Column(Integer, primary_key=True, index=True)
    session_name = Column(String(20), nullable=False, index=True)  # "morning" | "evening"
    step = Column(Integer, nullable=False)                          # 1(R1완료) | 2(R2완료)
    state_json = Column(Text, nullable=False)                       # 중간 데이터 (JSON)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)                   # 2시간 후 만료


class Watchlist(Base):
    __tablename__ = "watchlist"
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False)
    name = Column(String(100), nullable=False)
    exchange = Column(String(20), default="KOSPI")
    target_price = Column(Float, nullable=True)
    memo = Column(String(500), nullable=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PortfolioAnalysis(Base):
    __tablename__ = "portfolio_analysis"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, nullable=True)   # null = 계좌 미분류
    account_name = Column(String(100), nullable=True)  # null = "미분류"
    ticker = Column(String(20), nullable=False)
    name = Column(String(100), nullable=False)
    outlook = Column(String(20))          # bullish / neutral / bearish
    recommendation = Column(String(20))   # buy_more / hold / reduce / sell
    short_term_forecast = Column(String(2000))  # 단기 전망 2-3문장 (Korean)
    key_points_json = Column(String(3000))      # JSON array of 3 bullet strings (Korean)
    risks = Column(String(1000))                # 주요 리스크 1문장 (Korean)
    confidence = Column(String(10))             # high / medium / low
    session_date = Column(String(10))           # "YYYY-MM-DD" KST - for dedup
    generated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(__import__("sqlalchemy").text("PRAGMA journal_mode=WAL"))
        await conn.execute(__import__("sqlalchemy").text("PRAGMA synchronous=NORMAL"))
        await conn.execute(__import__("sqlalchemy").text("PRAGMA cache_size=10000"))

        # 기존 DB에 새 컬럼 추가 마이그레이션 (없으면 추가, 있으면 무시)
        migrations = [
            # Google Calendar 테이블 생성
            """CREATE TABLE IF NOT EXISTS calendar_token (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                google_email VARCHAR(256),
                encrypted_access_token TEXT NOT NULL,
                encrypted_refresh_token TEXT,
                token_expiry DATETIME,
                calendar_id VARCHAR(256) NOT NULL DEFAULT 'primary',
                sync_token TEXT,
                connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS calendar_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                google_event_id VARCHAR(256) NOT NULL,
                calendar_id VARCHAR(256) NOT NULL DEFAULT 'primary',
                summary VARCHAR(512),
                description TEXT,
                location VARCHAR(512),
                start_dt DATETIME,
                end_dt DATETIME,
                all_day INTEGER NOT NULL DEFAULT 0,
                recurrence TEXT,
                status VARCHAR(20) DEFAULT 'confirmed',
                html_link VARCHAR(1024),
                color_id VARCHAR(16),
                raw_json TEXT,
                synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, google_event_id)
            )""",
            """CREATE TABLE IF NOT EXISTS calendar_watch_channel (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                channel_id VARCHAR(256) NOT NULL UNIQUE,
                resource_id VARCHAR(256),
                calendar_id VARCHAR(256) NOT NULL DEFAULT 'primary',
                expiration DATETIME,
                active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_calendar_token_user_id ON calendar_token (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_calendar_event_user ON calendar_event (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_calendar_event_start ON calendar_event (user_id, start_dt)",
            "CREATE INDEX IF NOT EXISTS ix_calendar_watch_user ON calendar_watch_channel (user_id)",
            # user_profile 테이블 생성 (CREATE TABLE IF NOT EXISTS 방식)
            """CREATE TABLE IF NOT EXISTS user_profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                display_name VARCHAR(64),
                birth_date VARCHAR(10),
                profile_icon VARCHAR(8) DEFAULT '👤',
                job VARCHAR(64),
                retire_age INTEGER DEFAULT 60,
                monthly_income_만 INTEGER,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_user_profile_user_id ON user_profile (user_id)",
            "ALTER TABLE portfolio ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual'",
            "ALTER TABLE portfolio ADD COLUMN account_no VARCHAR(32)",
            "ALTER TABLE portfolio ADD COLUMN external_id VARCHAR(64)",
            "ALTER TABLE portfolio ADD COLUMN account_id INTEGER",
            "ALTER TABLE stock_master ADD COLUMN industry VARCHAR(100)",
            "ALTER TABLE news ADD COLUMN description TEXT",
            "CREATE INDEX IF NOT EXISTS ix_news_published_at ON news (published_at)",
            "ALTER TABLE recommendation ADD COLUMN reason TEXT",
            "ALTER TABLE recommendation ADD COLUMN confidence VARCHAR(20)",
            "ALTER TABLE recommendation ADD COLUMN ai_session VARCHAR(20)",
            "ALTER TABLE recommendation ADD COLUMN entry_price FLOAT",
            "ALTER TABLE recommendation ADD COLUMN entry_range_low FLOAT",
            "ALTER TABLE recommendation ADD COLUMN entry_range_high FLOAT",
            "ALTER TABLE recommendation ADD COLUMN target_price FLOAT",
            "ALTER TABLE recommendation ADD COLUMN target_return_pct FLOAT",
            "ALTER TABLE recommendation ADD COLUMN stop_loss_price FLOAT",
            "ALTER TABLE recommendation ADD COLUMN stop_loss_pct FLOAT",
            "ALTER TABLE recommendation ADD COLUMN technical_summary TEXT",
            "ALTER TABLE recommendation ADD COLUMN generated_at DATETIME",
            "ALTER TABLE recommendation ADD COLUMN community_sentiment TEXT",
            "ALTER TABLE recommendation ADD COLUMN political_theme VARCHAR(20)",
            "ALTER TABLE recommendation ADD COLUMN political_weight FLOAT",
            "ALTER TABLE calendar_watch_channel ADD COLUMN webhook_token VARCHAR(64)",
            "ALTER TABLE calendar_token ADD COLUMN calendars_json TEXT",
            "ALTER TABLE calendar_token ADD COLUMN sync_tokens_json TEXT",
            # investment_event 테이블
            """CREATE TABLE IF NOT EXISTS investment_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type VARCHAR(20) NOT NULL,
                event_date VARCHAR(10) NOT NULL,
                ticker VARCHAR(20),
                name VARCHAR(128),
                price FLOAT,
                quantity FLOAT,
                amount FLOAT,
                pnl FLOAT,
                pnl_pct FLOAT,
                note VARCHAR(256),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_investment_event_date ON investment_event (event_date)",
            "CREATE INDEX IF NOT EXISTS ix_investment_event_type ON investment_event (event_type)",
            # investment_diary 테이블
            """CREATE TABLE IF NOT EXISTS investment_diary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diary_date VARCHAR(10) NOT NULL UNIQUE,
                content TEXT NOT NULL,
                raw_data TEXT,
                generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_investment_diary_date ON investment_diary (diary_date)",
            "ALTER TABLE portfolio_snapshot ADD COLUMN realized_pnl FLOAT NOT NULL DEFAULT 0",
            # blog_posts 테이블
            """CREATE TABLE IF NOT EXISTS blog_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(500) NOT NULL DEFAULT '제목 없음',
                content TEXT,
                cover_image VARCHAR(500),
                visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                tags VARCHAR(1000),
                ai_generated BOOLEAN DEFAULT 0,
                word_count INTEGER DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_blog_posts_created_at ON blog_posts (created_at)",
            "CREATE INDEX IF NOT EXISTS ix_blog_posts_visibility ON blog_posts (visibility)",
            # investment_mark 테이블
            """CREATE TABLE IF NOT EXISTS investment_mark (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date VARCHAR(10) NOT NULL,
                title VARCHAR(256) NOT NULL,
                google_event_id VARCHAR(256),
                google_calendar_id VARCHAR(256),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_investment_mark_date ON investment_mark (date)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_investment_mark_gcal ON investment_mark (google_event_id)",
            # deposit_event 테이블
            """CREATE TABLE IF NOT EXISTS deposit_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_no VARCHAR(20) NOT NULL,
                date VARCHAR(10) NOT NULL,
                trde_no VARCHAR(40),
                amount FLOAT NOT NULL,
                remark VARCHAR(200),
                balance_after FLOAT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_deposit_event_account ON deposit_event (account_no)",
            "CREATE INDEX IF NOT EXISTS ix_deposit_event_date ON deposit_event (date)",
            "ALTER TABLE portfolio_snapshot ADD COLUMN cash_balance FLOAT NOT NULL DEFAULT 0",
            "ALTER TABLE investment_event ADD COLUMN account_no VARCHAR(32)",
        ]
        for sql in migrations:
            try:
                await conn.execute(__import__("sqlalchemy").text(sql))
            except Exception:
                pass  # 이미 컬럼 존재 시 무시

        # portfolio_snapshot: account_no 컬럼 추가 및 unique constraint 변경 (TOTAL=전체)
        _text = __import__("sqlalchemy").text
        try:
            await conn.execute(_text("SELECT account_no FROM portfolio_snapshot LIMIT 1"))
            # 이미 마이그레이션 완료
        except Exception:
            try:
                await conn.execute(_text("DROP TABLE IF EXISTS portfolio_snapshot_new"))
                await conn.execute(_text("""
                    CREATE TABLE portfolio_snapshot_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date DATETIME NOT NULL,
                        account_no VARCHAR(32) NOT NULL DEFAULT 'TOTAL',
                        total_value FLOAT NOT NULL,
                        total_cost FLOAT NOT NULL,
                        pnl FLOAT NOT NULL,
                        pnl_pct FLOAT NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(date, account_no)
                    )
                """))
                await conn.execute(_text("""
                    INSERT INTO portfolio_snapshot_new
                        (id, date, account_no, total_value, total_cost, pnl, pnl_pct, created_at)
                    SELECT id, date, 'TOTAL', total_value, total_cost, pnl, pnl_pct, created_at
                    FROM portfolio_snapshot
                """))
                await conn.execute(_text("DROP TABLE portfolio_snapshot"))
                await conn.execute(_text("ALTER TABLE portfolio_snapshot_new RENAME TO portfolio_snapshot"))
                await conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_portfolio_snapshot_date ON portfolio_snapshot (date)"))
            except Exception as me:
                import logging as _log
                _log.getLogger(__name__).warning(f"portfolio_snapshot migration failed: {me}")


class BlogPost(Base):
    __tablename__ = "blog_posts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False, default="제목 없음")
    content = Column(Text, nullable=True)         # TipTap HTML
    cover_image = Column(String(500), nullable=True)  # filename only
    visibility = Column(String(20), nullable=False, default="private")  # "public"|"private"
    tags = Column(String(1000), nullable=True)    # JSON 배열 문자열
    ai_generated = Column(Boolean, default=False)
    word_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Memo(Base):
    __tablename__ = "memo"
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False)
    body = Column(Text, nullable=True)            # 마크다운
    color = Column(String(20), nullable=True)     # 수동 색 지정 (null=자동)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
