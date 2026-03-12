# ─── Aşama 1: gnubg derleme ───────────────────────────────────────────────────
FROM debian:bookworm-slim AS gnubg-builder

RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    flex \
    bison \
    libglib2.0-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libreadline-dev \
    libsqlite3-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q https://ftp.gnu.org/gnu/gnubg/gnubg-release-1.08.003-sources.tar.gz \
    && tar -xzf gnubg-release-1.08.003-sources.tar.gz \
    && cd gnubg-1.08.003 \
    && ./configure --without-gtk --without-board3d --prefix=/usr/local \
    && make -j$(nproc) \
    && make install \
    && cd .. && rm -rf gnubg-*

# Hangi .so dosyaları gerekiyor — bunu log'a yaz
RUN ldd /usr/local/bin/gnubg

# ─── Aşama 2: Node.js uygulama ────────────────────────────────────────────────
FROM node:20-slim

# Tüm olası bağımlılıkları kur
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libreadline8 \
    libsqlite3-0 \
    libpython3.11 \
    libfontconfig1 \
    libfreetype6 \
    libpng16-16 \
    libpixman-1-0 \
    libxcb-shm0 \
    libxcb-render0 \
    libxrender1 \
    libx11-6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=gnubg-builder /usr/local/bin/gnubg /usr/local/bin/gnubg
COPY --from=gnubg-builder /usr/local/share/gnubg /usr/local/share/gnubg

RUN ln -sf /usr/local/bin/gnubg /usr/local/bin/gnubg-cli \
    && chmod +x /usr/local/bin/gnubg

# Eksik .so var mı kontrol et
RUN ldd /usr/local/bin/gnubg-cli || true

# gnubg gerçekten çalışıyor mu test et
RUN echo "quit" | gnubg-cli --tty 2>&1 || true

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
