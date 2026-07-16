import "./globals.css";

export const metadata = {
  title: "GRE Error Ledger",
  description: "Interactive GRE mistake tracker and practice engine",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
