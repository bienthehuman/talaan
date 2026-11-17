FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 1 only for dev and e2e builds: routes the /styleguide page. Production builds leave it at 0.
ARG VITE_STYLEGUIDE=0
ENV VITE_STYLEGUIDE=$VITE_STYLEGUIDE
RUN npm run build

FROM nginx:1-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
