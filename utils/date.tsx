import {format, parseISO} from 'date-fns';

export const utcDateToLocalTimeString = (dateString: string | undefined): string => {
  if (!dateString) {
    return 'Unknown';
  }
  const date = parseISO(dateString);
  return format(date, `EEE, MMM d, yyyy h:mm a`);
};
