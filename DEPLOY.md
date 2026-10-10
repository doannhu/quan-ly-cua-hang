# Cài đặt trên VPS không dùng Docker (SQLite)

Hướng dẫn cho Ubuntu 22.04/24.04, đăng nhập bằng `root`. Kết quả:

```
Trình duyệt ──▶ nginx :80 ──┬─ /            → file tĩnh frontend (/var/www/quan-ly-cua-hang)
                            └─ /api, /uploads → backend Node :4000 (chỉ nghe 127.0.0.1)
                                                 └─ SQLite: /var/lib/quan-ly-cua-hang/store.db
```

| Thành phần | Cấu hình ở đâu |
|---|---|
| **Database** | Không cần cài server: SQLite là 1 file, tự tạo khi backend chạy lần đầu |
| **Backend** | `/opt/quan-ly-cua-hang/backend/.env` (mẫu: `backend/.env.example`) |
| **Frontend** | **Không cần env**: gọi API cùng tên miền qua `/api`, nginx chuyển tiếp về backend |

## 1. Cài phần mềm

```bash
apt update && apt install -y curl git nginx ufw sqlite3
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # cần >= 22.13 (SQLite có sẵn trong Node)
```

## 2. Tạo user chạy app và thư mục

```bash
useradd --system --home /opt/quan-ly-cua-hang --shell /usr/sbin/nologin quanly
git clone https://github.com/doannhu/quan-ly-cua-hang.git /opt/quan-ly-cua-hang
mkdir -p /var/lib/quan-ly-cua-hang/uploads
chown -R quanly:quanly /var/lib/quan-ly-cua-hang
```

## 3. Backend + env

```bash
cd /opt/quan-ly-cua-hang/backend
npm ci --omit=dev
cp .env.example .env
# Tạo secret ngẫu nhiên và điền vào .env:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^AI_API_KEY=.*|AI_API_KEY=$(openssl rand -hex 24)|" .env
nano .env          # đổi ADMIN_PASSWORD thành mật khẩu mạnh
chown root:quanly .env && chmod 640 .env
```

Các biến trong `backend/.env`:

| Biến | Ý nghĩa |
|---|---|
| `PORT`, `HOST` | Cổng backend; `HOST=127.0.0.1` để chỉ nginx truy cập được |
| `DB_DRIVER` | `sqlite` (mặc định) hoặc `mongo` |
| `SQLITE_PATH` | File database, mặc định `/var/lib/quan-ly-cua-hang/store.db` |
| `UPLOAD_DIR` | Thư mục lưu ảnh chụp khay |
| `ADMIN_PASSWORD` | Mật khẩu đăng nhập tên `admin` |
| `JWT_SECRET` | Chuỗi ngẫu nhiên dài để ký phiên đăng nhập |
| `AI_API_KEY` | (Tuỳ chọn) key chỉ-đọc cho AI agent, header `X-API-Key` |
| `TZ` | Múi giờ ghi ngày/giờ báo cáo |

Chạy backend bằng systemd (tự khởi động lại khi lỗi/reboot):

```bash
cp /opt/quan-ly-cua-hang/deploy/quan-ly-cua-hang.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now quan-ly-cua-hang
systemctl status quan-ly-cua-hang        # phải thấy: API listening on 127.0.0.1:4000 (db: sqlite)
curl -s http://127.0.0.1:4000/api/health # {"ok":true}
```

## 4. Frontend

```bash
cd /opt/quan-ly-cua-hang/frontend
npm ci && npm run build
mkdir -p /var/www/quan-ly-cua-hang
cp -r dist/* /var/www/quan-ly-cua-hang/
```

## 5. nginx + firewall

```bash
cp /opt/quan-ly-cua-hang/deploy/nginx.conf /etc/nginx/sites-available/quan-ly-cua-hang
ln -sf /etc/nginx/sites-available/quan-ly-cua-hang /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

Mở `http://<IP-VPS>` và đăng nhập `admin` / `ADMIN_PASSWORD`.

**HTTPS (nếu có tên miền):** trỏ tên miền về IP VPS, sửa `server_name` trong file nginx, rồi
`apt install -y certbot python3-certbot-nginx && certbot --nginx -d ten-mien.vn`.

## 6. Chuyển dữ liệu cũ (từ bản Docker/MongoDB)

Trên máy đang chạy Docker, tạo file SQLite từ MongoDB và nén ảnh:

```bash
docker compose start mongo
docker compose run --rm --no-deps -e SQLITE_PATH=/out/store.db -v "$PWD/migration-export:/out" \
  backend node scripts/migrate-mongo-to-sqlite.js
docker run --rm -v store-app_uploads:/u:ro -v "$PWD/migration-export:/out" alpine tar czf /out/uploads.tgz -C /u .
```

Đưa lên VPS **trước khi** có ai dùng bản mới (sẽ ghi đè database trên VPS):

```bash
scp migration-export/store.db migration-export/uploads.tgz root@<IP-VPS>:/tmp/
# trên VPS:
systemctl stop quan-ly-cua-hang
cp /tmp/store.db /var/lib/quan-ly-cua-hang/store.db
rm -f /var/lib/quan-ly-cua-hang/store.db-wal /var/lib/quan-ly-cua-hang/store.db-shm
tar xzf /tmp/uploads.tgz -C /var/lib/quan-ly-cua-hang/uploads
chown -R quanly:quanly /var/lib/quan-ly-cua-hang
systemctl start quan-ly-cua-hang
```

## 7. Sao lưu hằng ngày

```bash
mkdir -p /var/backups/quan-ly-cua-hang
cat > /etc/cron.daily/quan-ly-cua-hang-backup <<'EOF'
#!/bin/sh
d=/var/backups/quan-ly-cua-hang; t=$(date +%F)
sqlite3 /var/lib/quan-ly-cua-hang/store.db ".backup '$d/store-$t.db'"
tar czf "$d/uploads-$t.tgz" -C /var/lib/quan-ly-cua-hang uploads
find "$d" -type f -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/quan-ly-cua-hang-backup
```

Nên chép thư mục backup ra ngoài VPS định kỳ.

## 8. Cập nhật phiên bản mới

```bash
cd /opt/quan-ly-cua-hang && git pull
cd backend && npm ci --omit=dev && systemctl restart quan-ly-cua-hang
cd ../frontend && npm ci && npm run build && cp -r dist/* /var/www/quan-ly-cua-hang/
```

## Xử lý sự cố

| Triệu chứng | Kiểm tra |
|---|---|
| Trang trắng / 502 Bad Gateway | `systemctl status quan-ly-cua-hang`, `journalctl -u quan-ly-cua-hang -n 50` |
| `Missing env var ...` | Thiếu biến trong `backend/.env` |
| `SQLITE_CANTOPEN` / không lưu được ảnh | Quyền thư mục: `chown -R quanly:quanly /var/lib/quan-ly-cua-hang` |
| Tải ảnh lỗi 413 | `client_max_body_size` trong file nginx |
| Không vào được từ ngoài | `ufw status`, tường lửa của nhà cung cấp VPS |
