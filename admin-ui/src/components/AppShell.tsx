import MenuIcon from '@mui/icons-material/Menu';
import TranslateIcon from '@mui/icons-material/Translate';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { APP_NAME } from '../config';
import { LANGUAGES, useTranslation } from '../i18n';
import type { Language } from '../i18n';
import { gradients, neutral } from '../theme/tokens';
import { useIsMobile } from '../ui';

/**
 * App shell: AppBar with the configurable brand name, primary navigation
 * (Dashboard / Customers / Documents / Settings), a language switcher and a user
 * chip (name/avatar from the Google token) with sign-out. Below the `md`
 * breakpoint the navigation collapses into a hamburger + temporary Drawer; the
 * language switcher and user chip stay reachable in the AppBar.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const { t, language, setLanguage } = useTranslation();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [langAnchor, setLangAnchor] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const nav = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/customers', label: t('nav.customers') },
    { to: '/events', label: t('nav.events') },
    { to: '/documents', label: t('nav.documents') },
    { to: '/email-templates', label: t('nav.emailTemplates') },
    { to: '/settings', label: t('nav.settings') },
  ];

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="sticky" sx={{ background: gradients.heroBand }}>
        <Toolbar sx={{ gap: { xs: 1, md: 3 } }}>
          {isMobile && (
            <IconButton
              edge="start"
              onClick={() => setDrawerOpen(true)}
              sx={{ color: '#fff' }}
              aria-label={t('appShell.openMenu')}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h5" component="div" sx={{ fontWeight: 600, color: '#fff' }}>
            {APP_NAME}
          </Typography>
          {!isMobile && (
            <>
              <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)', mr: 2 }}>
                {t('appShell.subtitle')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexGrow: 1 }}>
                {nav.map((item) => (
                  <Button
                    key={item.to}
                    component={RouterLink}
                    to={item.to}
                    sx={{
                      color: '#fff',
                      opacity: isActive(item.to) ? 1 : 0.75,
                      borderBottom: isActive(item.to) ? '2px solid #fff' : '2px solid transparent',
                      borderRadius: 0,
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </Box>
            </>
          )}
          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title={t('language.label')}>
            <IconButton
              onClick={(event) => setLangAnchor(event.currentTarget)}
              sx={{ color: '#fff' }}
              aria-label={t('language.label')}
            >
              <TranslateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={langAnchor} open={langAnchor !== null} onClose={() => setLangAnchor(null)}>
            {LANGUAGES.map((code: Language) => (
              <MenuItem
                key={code}
                selected={code === language}
                onClick={() => {
                  setLanguage(code);
                  setLangAnchor(null);
                }}
              >
                {t(`language.${code}`)}
              </MenuItem>
            ))}
          </Menu>

          <Button
            onClick={(event) => setAnchor(event.currentTarget)}
            sx={{ color: '#fff', textTransform: 'none', gap: 1, minWidth: 44 }}
          >
            <Avatar
              src={user?.picture}
              alt={user?.name ?? ''}
              sx={{ width: 28, height: 28, bgcolor: neutral[200], color: neutral[700] }}
            >
              {user?.name?.[0] ?? user?.email?.[0] ?? '?'}
            </Avatar>
            {!isMobile && (
              <Typography variant="body1" sx={{ color: '#fff' }}>
                {user?.name ?? user?.email ?? t('appShell.signedIn')}
              </Typography>
            )}
          </Button>
          <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
            <MenuItem disabled sx={{ opacity: '1 !important' }}>
              <Box>
                <Typography variant="body1">{user?.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {user?.email}
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem
              onClick={() => {
                setAnchor(null);
                logout();
              }}
            >
              {t('appShell.signOut')}
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 260 }} role="navigation">
          <Box sx={{ p: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {APP_NAME}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('appShell.subtitle')}
            </Typography>
          </Box>
          <List>
            {nav.map((item) => (
              <ListItemButton
                key={item.to}
                component={RouterLink}
                to={item.to}
                selected={isActive(item.to)}
                onClick={() => setDrawerOpen(false)}
                sx={{ minHeight: 48 }}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 4 }, px: { xs: 2, md: 3 } }}>
        <Outlet />
      </Container>
    </Box>
  );
}
