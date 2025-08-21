FROM node:18-alpine
WORKDIR /app
# Copy ONLY package.json so Docker can cache layer
COPY package.json ./
# Regular install (no lockfile). Omit dev deps for smaller image.
RUN npm install --no-audit --prefer-offline --omit=dev
# Now copy the rest and run
COPY . .
EXPOSE 3000
CMD ["node","server.js"]
