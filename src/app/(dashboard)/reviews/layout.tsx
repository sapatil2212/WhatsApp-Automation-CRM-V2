import type { ReactNode } from 'react';

import { ReviewTabs } from '@/components/reviews/shared';

export default function ReviewsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <ReviewTabs />
      {children}
    </div>
  );
}