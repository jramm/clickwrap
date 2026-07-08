/**
 * ui/SearchField — a clearable search input adapter.
 * Internally an MUI TextField with a leading search icon and a trailing clear button that appears
 * once there is text. The props are library-agnostic.
 */
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MuiTextField from '@mui/material/TextField';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible label for the input and the clear button. */
  label: string;
  clearLabel: string;
}

export function SearchField({ value, onChange, placeholder, label, clearLabel }: SearchFieldProps) {
  return (
    <MuiTextField
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      size="small"
      fullWidth
      inputProps={{ 'aria-label': label }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton aria-label={clearLabel} size="small" edge="end" onClick={() => onChange('')}>
              <ClearIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
    />
  );
}
