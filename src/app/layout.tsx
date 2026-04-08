/**
 * Root Layout
 */

import React from 'react';

export const metadata = {
  title: 'Cisco Network Simulator',
  description: 'Browser-Based Cisco Network Simulator with Konva.js',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          overflow: 'hidden',
        }}
      >
        {children}
      </body>
    </html>
  );
}
