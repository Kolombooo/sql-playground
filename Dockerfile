# ---- build the Tailwind stylesheet ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tailwind.config.js ./
COPY public ./public
RUN npm run build:css

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server ./server
COPY db ./db
COPY public ./public
COPY --from=build /app/public/tailwind.css ./public/tailwind.css
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
