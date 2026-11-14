import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Moto Atelier 3D — Motorcycle Vehicle Studio & Physics Simulator',
  description:
    'Xưởng thiết kế, tùy biến cơ khí và mô phỏng vận hành xe máy 3D thực tế với hình học độ chi tiết cao, vật lý hai bánh chuẩn xác và hệ thống tiếp nhận mẫu xe mở rộng.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="dark">
      <body className="bg-[#090c12] font-sans text-slate-100 antialiased selection:bg-amber-400/30 selection:text-amber-100">
        {children}
      </body>
    </html>
  );
}
