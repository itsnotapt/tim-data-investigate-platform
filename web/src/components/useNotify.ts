import { useContext } from 'react';
import { NotifyContext, type Notify } from './notifyContext';

export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error('useNotify must be used within <SnackbarHost>');
  return notify;
}
