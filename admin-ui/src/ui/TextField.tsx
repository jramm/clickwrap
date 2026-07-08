/**
 * ui/TextField & ui/Select — form field adapters.
 * Internally MUI TextField; the props are library-agnostic.
 */
import MenuItem from '@mui/material/MenuItem';
import MuiTextField from '@mui/material/TextField';
import type { TextFieldProps as MuiTextFieldProps } from '@mui/material/TextField';

export type TextFieldProps = MuiTextFieldProps;

export function TextField(props: TextFieldProps) {
  return <MuiTextField fullWidth size="small" {...props} />;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<TextFieldProps, 'select' | 'children'> {
  options: SelectOption[];
}

export function Select({ options, ...rest }: SelectProps) {
  return (
    <MuiTextField select fullWidth size="small" {...rest}>
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </MuiTextField>
  );
}
