FROM node:22-slim

WORKDIR /app

COPY server.js package.json ./
COPY public/ public/
COPY lib/ lib/
COPY bin/ bin/
COPY demo/ demo/
COPY oh-package.json5 ./

# Demo mode by default (no opencode backend required)
ENV PILOT_DEMO=1
ENV PORT=4097
ENV PILOT_HOST=0.0.0.0

# Must set PILOT_TOKEN at runtime for non-loopback access
# docker run -e PILOT_TOKEN=your-secret -p 4097:4097 oc-pilot

EXPOSE 4097

CMD ["node", "server.js"]
