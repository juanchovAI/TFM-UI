# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --silent
COPY . .
RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Remove default nginx.conf and provide smaller timeouts if desired
# Expose port 80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
