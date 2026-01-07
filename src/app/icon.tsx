import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};

export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#3b180f',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          color: '#f5f2ea',
          fontWeight: 600,
          letterSpacing: '0.1em',
        }}
      >
        XC
      </div>
    ),
    {
      width: size.width,
      height: size.height,
    }
  );
}
