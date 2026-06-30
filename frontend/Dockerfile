FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json .
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
# Rate-limit zones must load at http{} scope before default.conf — the
# "00-" prefix sorts first within conf.d (which nginx includes into http{}).
COPY ratelimit.conf /etc/nginx/conf.d/00-ratelimit.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
