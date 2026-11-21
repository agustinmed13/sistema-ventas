import { Public_Sans } from "next/font/google";
import "./globals.css";

// Tipografía de todo el sistema. "variable" es el nombre de la variable CSS
// donde queda guardada la fuente; globals.css (--font-sans) la usa desde ahí.
const publicSans = Public_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata = {
  title: "Mostrador · Gestión comercial",
  description: "Facturación, control de stock y cuenta corriente de clientes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${publicSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}