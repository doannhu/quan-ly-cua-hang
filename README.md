# Quản lý cửa hàng – Store inventory app

React (Vite) + Express + MongoDB, chạy bằng Docker. Giao diện mobile-first kiểu iOS.

## Chạy

```bash
cp .env.example .env   # đổi ADMIN_PASSWORD, JWT_SECRET (và AI_API_KEY nếu cần)
docker compose up -d --build
```

Mở http://localhost:8080 (đổi cổng bằng `WEB_PORT`).

- **Admin**: tên `admin`, mật khẩu = `ADMIN_PASSWORD` trong `.env`.
  Tạo cửa hàng → quầy lớn → quầy nhỏ, tạo tài khoản nhân viên, xem tổng hàng theo ngày / ca / cửa hàng (bấm vào từng báo cáo để xem khay + ảnh).
- **Nhân viên**: đăng nhập bằng tên + mật khẩu do admin tạo, chọn cửa hàng/quầy, nhập khay, bấm “Nộp thông tin” và xác nhận.

## Kiến trúc

```
frontend (nginx, React SPA) ──/api, /uploads──▶ backend (Express) ──▶ MongoDB
```

- `backend/src/db/` – lớp repository (`insert/get/find/update/remove`). Chọn driver bằng `DB_DRIVER`; để dùng database khác chỉ cần thêm một driver trả về cùng 4 repo (`users`, `stores`, `counters`, `reports`) trong `db/index.js`.
- `backend/src/routes/` – mỗi nhóm chức năng một router; thêm báo cáo/quản lý mới = thêm một file route.
- Ảnh lưu ở volume `uploads` (nén về ≤1600px ở trình duyệt trước khi tải lên).
- Ngày/giờ báo cáo do server ghi theo `TZ` (mặc định `Asia/Ho_Chi_Minh`).

## Cho AI agent

Đặt `AI_API_KEY` trong `.env`, rồi gọi các endpoint chỉ-đọc với header `X-API-Key`:

| Endpoint | Mô tả |
|---|---|
| `GET /api/openapi.json` | Mô tả API (không cần key) |
| `GET /api/admin/reports?from=&to=&storeId=&shift=` | Báo cáo chi tiết (khay, ảnh) |
| `GET /api/admin/reports/summary?...` | Tổng hàng theo ngày / ca / cửa hàng |
| `GET /api/ai/stores` | Cửa hàng, quầy lớn, quầy nhỏ |
| `GET /api/ai/staff` | Danh sách nhân viên |

Có thể bọc các endpoint này thành MCP server khi cần.

## Dev không dùng Docker

```bash
cd backend  && npm i && ADMIN_PASSWORD=x JWT_SECRET=y npm run dev   # cần MongoDB ở localhost:27017
cd frontend && npm i && npm run dev                                # proxy /api → localhost:4000
```
