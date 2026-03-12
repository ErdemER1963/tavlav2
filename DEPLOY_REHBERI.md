# 🎲 Tavla V2 — Railway Deploy Rehberi

## Gereksinimler
- [GitHub](https://github.com) hesabı
- [Railway](https://railway.app) hesabı (GitHub ile giriş yapabilirsiniz)

---

## Adım 1: Proje Dosyalarını Hazırla

Bu repo'daki dosyaları projenizin ana dizinine kopyalayın:
- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `railway.toml`

---

## Adım 2: GitHub'a Yükle

```bash
# Proje klasöründe terminal aç
git init
git add .
git commit -m "ilk commit"

# GitHub'da yeni repo oluşturup bağla
git remote add origin https://github.com/KULLANICI_ADI/tavla-v2.git
git branch -M main
git push -u origin main
```

---

## Adım 3: Railway'de Proje Oluştur

1. [railway.app](https://railway.app) → **Start a New Project**
2. **Deploy from GitHub repo** seçin
3. GitHub hesabınızı bağlayın, `tavla-v2` reposunu seçin
4. Railway otomatik olarak `Dockerfile`'ı algılar

---

## Adım 4: Ortam Değişkeni Ekle (Opsiyonel)

Railway dashboard → **Variables** sekmesi:

```
NODE_ENV = production
```

PORT değişkenini Railway otomatik olarak ayarlar, siz eklemenize gerek yok.

---

## Adım 5: Deploy Bekle

- İlk build **10-15 dakika** sürebilir (gnubg derleniyor)
- **Deploy Logs** sekmesinden canlı takip edebilirsiniz
- Başarılı olunca şu mesajı görürsünüz:
  ```
  ✅ GNU Backgammon bulundu: ...
  🎲 Tavla V2 Sunucusu çalışıyor!
  ```

---

## Adım 6: URL'yi Al

Railway dashboard → **Settings** → **Domains** → **Generate Domain**

Örnek: `https://tavla-v2-production.up.railway.app`

---

## 💰 Ücretsiz Tier Limitleri

| Kaynak | Limit |
|--------|-------|
| RAM | 512 MB |
| CPU | 0.5 vCPU |
| Aylık Kullanım | 500 saat |
| Bant Genişliği | 100 GB/ay |

> ⚠️ 500 saat = ~21 gün. Sürekli açık kalması için **Hobby Plan** ($5/ay) düşünebilirsiniz.

---

## 🔧 Sorun Giderme

**gnubg bulunamadı hatası:**
```
# Railway shell'de test edin
gnubg-cli --version
```

**Build çok uzun sürüyor:**
- Normal, ilk build 15 dk sürebilir. Sonraki build'ler Docker cache sayesinde çok hızlı olur.

**WebSocket bağlanamıyor:**
- Railway WebSocket'i destekler, ekstra ayar gerekmez.
- Client tarafında URL'yi şöyle güncelleyin:
  ```javascript
  const ws = new WebSocket('wss://SIZIN-URL.up.railway.app');
  ```

---

## 🚀 Alternatif: Fly.io (gnubg destekli)

Railway yerine Fly.io tercih ederseniz:

```bash
# Fly CLI kur
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Deploy (Dockerfile'ı otomatik algılar)
fly launch
fly deploy
```

Fly.io ücretsiz tier: 3 VM, 256MB RAM her biri.
