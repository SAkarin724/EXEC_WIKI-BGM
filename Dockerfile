FROM caddy:latest
COPY ./Caddyfile /etc/caddy/Caddyfile
COPY ./dist /usr/share/caddy
