/**
 * ui/Card — card adapter.
 * Internally MUI Card/CardContent; the props are library-agnostic.
 */
import MuiCard from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Removes the inner padding (e.g. for embedded tables). */
  disableContentPadding?: boolean;
}

export function Card({ title, action, children, disableContentPadding }: CardProps) {
  return (
    <MuiCard variant="outlined">
      {(title || action) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Wrap on narrow screens: otherwise a wide title block pushes the action
            // button out of the viewport (mobile bug: hidden "new version" button).
            flexWrap: 'wrap',
            gap: 12,
            padding: '16px 20px',
          }}
        >
          {typeof title === 'string' ? (
            <Typography variant="h5" component="h2">
              {title}
            </Typography>
          ) : (
            title
          )}
          <div style={{ flexShrink: 0 }}>{action}</div>
        </div>
      )}
      {disableContentPadding ? children : <CardContent>{children}</CardContent>}
    </MuiCard>
  );
}
