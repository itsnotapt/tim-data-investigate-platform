import Typography from '@mui/material/Typography';
import { useTabsStore } from './tabStore';
import type { TabComponentProps } from './tabRegistry';

/** Stand-in until the real KustoQueryTab (P4-06) / TemplateQueryTab (P4-18) are registered. */
export function TabPlaceholder({ uuid }: TabComponentProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  if (!tab) return null;
  return (
    <>
      <Typography variant="h5" component="h2" gutterBottom>
        {tab.title}
      </Typography>
      <Typography color="text.secondary">{`${tab.componentName}: ${uuid}`}</Typography>
    </>
  );
}
