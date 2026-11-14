# Moto Atelier 3D — Motorcycle Vehicle Studio

Repo này đã được dựng lại từ source trong `advanced-3d-motorcycle-studio.zip` thành một project chạy độc lập: mã nguồn Next.js, database local, font self-hosted và các GLB nguồn dùng để tạo model đều nằm trong repo. Khi cài npm, project tự giải nén model gốc và tạo các GLB runtime trong `public/models/`; ứng dụng không tải model hoặc font từ dịch vụ bên ngoài.

## Chạy nhanh

Yêu cầu: Node.js 22+, npm 10+ và Docker Compose.

```bash
cp .env.example .env
docker compose up --build -d
```

Mở <http://localhost:3000>. Compose khởi động PostgreSQL, build ứng dụng, tạo schema Drizzle và chạy Next.js. Dữ liệu PostgreSQL được lưu trong volume `moto_atelier_postgres`.

### Chạy bằng Next.js dev server

```bash
cp .env.example .env
docker compose up -d db
npm ci
npm run db:push
npm run dev
```

`npm ci` gọi `postinstall`: giải nén bốn GLB gốc đã đóng gói tại `assets/model-sources/`, chạy pipeline rig/optimize và kiểm tra các file trong `public/models/`. Chỉ hình học từ model nguồn được đưa vào GLB runtime; các phụ tùng không có trong model gốc không được tự sinh thêm.

## Asset nguồn và model còn thiếu

Các model runtime hiện có được tạo từ đúng GLB đã cung cấp, không thay bằng model khác:

- Honda Super Cub C90 — `honda_super_cub.glb`
- Honda CG 125 Classic — `motorbike_-_honda_cg_125.glb`
- Fat Boy Cruiser — `motorcycle_harley_davidson_fat_boy_inspired.glb`
- XYN Custom Bobber — `harledson_XYN.glb` trong `harledson-xyn.zip`

**Còn thiếu đúng một asset nguồn:** source của `street-sport-650` (`sportbike_eriklys.glb`) được script gốc tham chiếu ở `/tmp/research/extra/`, nhưng file đó không có trong thư mục Drive bạn gửi. Vì yêu cầu không dùng model thay thế, repo không tạo model giả cho xe này; giao diện ẩn xe đó và báo thiếu source. Khi có đúng file gốc, đặt nó tại `assets/source/sportbike_eriklys.glb` rồi chạy:

```bash
npm run models:build -- street-sport-650
```

Sau đó restart ứng dụng; xe sẽ tự xuất hiện vì model file đã tồn tại. Không cần sửa catalog hay thay model bằng xe khác.

## Lệnh hữu ích

```bash
npm run assets:prepare  # giải nén source và tạo lại các model có đủ input
npm run assets:check    # kiểm tra model URL trong catalog có file local hay chưa
npm run models:build -- super-cub-c90
npm run typecheck
npm run lint
```

`assets/source/` là thư mục làm việc cho input đã giải nén hoặc source bổ sung; các file đó được ignore bởi Git. Bản nén gốc nằm trong `assets/model-sources/` để có thể tái tạo bốn model đã cung cấp; bốn runtime GLB tương ứng cũng được version trong `public/models/` và tải cùng source từ GitHub. Chạy `npm ci` hoặc `npm run assets:prepare` sẽ tái tạo, kiểm tra các file này từ đúng source.

## Thành phần

- Next.js 16 / React 19 / TypeScript
- Three.js, vật lý và rigging xe máy, configurator, garage, telemetry và GLB import pipeline
- PostgreSQL 16 local qua Docker Compose + Drizzle ORM
- Font Inter và JetBrains Mono self-hosted từ npm, không cần tải Google Fonts trong lúc build/runtime
- `scripts/process-vehicles.mjs`: pipeline tạo/rig GLB theo từng `vehicle-id`

## Attribution hiện có trong catalog

- Super Cub: Aleksandr Sagidullin (CC-BY-4.0)
- Honda CG 125: LazyAstronaut3D (Sketchfab Standard)
- Fat Boy: christianchristian (CC-BY-4.0)
- XYN Bobber: harledson-xyn (tài nguyên trong thư mục Drive đã cung cấp)
- Street Sport 650: eriklys (CC-BY-4.0 qua Delta City open asset) — source GLB chưa có trong thư mục Drive

Thông tin attribution đầy đủ cũng được giữ trong `src/lib/vehicles/catalog.ts`.
