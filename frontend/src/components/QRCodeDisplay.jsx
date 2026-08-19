import { QRCodeSVG } from 'qrcode.react';

/**
 * Renders a QR code from a qr_token string.
 * Uses qrcode.react's SVG renderer for crisp scaling.
 */
export default function QRCodeDisplay({ value, size = 180 }) {
  if (!value) return null;

  return (
    <div className="inline-flex flex-col items-center gap-3 p-4 bg-white rounded-2xl shadow-inner">
      <QRCodeSVG
        value={value}
        size={size}
        bgColor="#ffffff"
        fgColor="#0f172a"
        level="M"
        includeMargin={false}
      />
      <p className="text-xs font-mono text-surface-500 select-all break-all max-w-[200px] text-center">
        {value}
      </p>
    </div>
  );
}
