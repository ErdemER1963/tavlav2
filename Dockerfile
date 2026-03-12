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

# gnubg kaynak kodunu indir ve derle (sadece CLI, GUI yok)
RUN wget -q https://ftp.gnu.org/gnu/gnubg/gnubg-release-1.08.003-sources.tar.gz \
    && tar -xzf gnubg-release-1.08.003-sources.tar.gz \
    && cd gnubg-1.08.003 \
    && ./configure \
        --without-gtk \
        --without-board3d \
        --disable-gui \
        --prefix=/usr/local \
    && make -j$(nproc) \
    && make install \
    && cd .. \
    && rm -rf gnubg-*

# ─── Aşama 2: Node.js uygulama ────────────────────────────────────────────────
FROM node:20-slim

# gnubg çalışma bağımlılıkları
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libcairo2 \
    libpango-1.0-0 \
    libreadline8 \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

# gnubg binary ve veri dosyalarını kopyala
COPY --from=gnubg-builder /usr/local/bin/gnubg /usr/local/bin/gnubg
COPY --from=gnubg-builder /usr/local/share/gnubg /usr/local/share/gnubg
COPY --from=gnubg-builder /usr/local/lib/gnubg* /usr/local/lib/

# gnubg-cli symlink oluştur (bridge.js 'gnubg-cli' olarak çağırıyor)
RUN ln -s /usr/local/bin/gnubg /usr/local/bin/gnubg-cli

# Çalışma dizini
WORKDIR /app

# Bağımlılıkları önce kopyala (Docker cache optimizasyonu)
COPY package*.json ./
RUN npm ci --only=production

# Uygulama dosyalarını kopyala
COPY . .

# Railway dinamik port kullanır
EXPOSE 3001

# Sağlık kontrolü
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/api/gnubg/status', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
