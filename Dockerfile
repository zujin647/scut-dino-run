# 生产镜像：不需要装任何依赖，把整份目录拷进去即可
#   docker build -t scut-run .
#   docker run -d -p 4173:4173 -v scut-data:/data -e ADMIN_PASSWORD=换成你的密码 scut-run
FROM node:20-alpine

WORKDIR /app

COPY . .

ENV PORT=4173 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 4173

CMD ["node", "server.js"]
