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
        --prefix=/usr/local \
    && make -j$(nproc) \
    && make install \
    && cd .. \
    && rm -rf gnubg-*

# Derleme sonucunu doğrula
RUN ls -la /usr/local/bin/gnubg && /usr/local/bin/gnubg --version || true

# ─── Aşama 2: Node.js uygulama ────────────────────────────────────────────────
FROM node:20-slim

# gnubg çalışma bağımlılıkları
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libcairo2 \
    libpango-1.0-0 \
    libreadline8 \
    libsqlite3-0 \
    libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# gnubg binary kopyala
COPY --from=gnubg-builder /usr/local/bin/gnubg /usr/local/bin/gnubg

# gnubg veri dosyaları (neural net weights vb.)
COPY --from=gnubg-builder /usr/local/share/gnubg /usr/local/share/gnubg

# gnubg-cli symlink oluştur (gnubg-bridge.js 'gnubg-cli' olarak çağırıyor)
RUN ln -sf /usr/local/bin/gnubg /usr/local/bin/gnubg-cli \
    && chmod +x /usr/local/bin/gnubg

# Kurulumu doğrula
RUN which gnubg-cli && gnubg-cli --version || echo "gnubg-cli kuruldu ama --version çalışmadı"

# Çalışma dizini
WORKDIR /app

# Bağımlılıkları önce kopyala (Docker cache optimizasyonu)
COPY package*.json ./
RUN npm ci --only=production

# Uygulama dosyalarını kopyala
COPY . .

# Railway dinamik port kullanır
EXPOSE 3001

CMD ["node", "server.js"]
