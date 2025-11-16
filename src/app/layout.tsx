import type { Metadata } from 'next';
import { Lato } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/providers/theme-provider';

const lato = Lato({
  subsets: ['latin'],
  weight: ['300', '400', '700'],
  variable: '--font-lato',
});

export const metadata: Metadata = {
  title: 'Xoco Café POS',
  description: 'Panel POS integrado con Supabase y la app de clientes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${lato.variable} antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
