import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { Fragment } from 'react';
import { subfolders } from './presetForm';

/**
 * A folder in the New menu as chips with › between its levels, the top level first. Each Enter
 * adds a level, picked from the existing folders at that level or typed.
 */
export function FolderField({
  value,
  folders,
  onChange,
}: {
  value: string[];
  /** The existing folders, each as its levels. */
  folders: readonly (readonly string[])[];
  onChange: (folder: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      options={subfolders(folders, value)}
      value={value}
      onChange={(_, folder) =>
        onChange(folder.map((level) => level.trim()).filter((level) => level !== ''))
      }
      renderValue={(levels, getItemProps) =>
        levels.map((level, index) => {
          const { key, ...props } = getItemProps({ index });
          return (
            <Fragment key={key}>
              {index > 0 && <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
              <Chip size="small" icon={<FolderOutlinedIcon />} label={level} {...props} />
            </Fragment>
          );
        })
      }
      renderInput={(input) => (
        <TextField
          {...input}
          label="Menu folder"
          placeholder={value.length === 0 ? 'Top level' : 'Subfolder…'}
          helperText="Pick or type a folder, Enter for each level"
        />
      )}
    />
  );
}
