import React from 'react';
import { type MarkdownWidget } from '../types';
import ReactMarkdown from 'react-markdown';

interface MarkdownWidgetProps {
  widget: MarkdownWidget;
  data?: any;
}

const MarkdownWidget: React.FC<MarkdownWidgetProps> = ({ widget }) => {
  return (
    <div className="w-full h-full overflow-auto prose dark:prose-invert max-w-none">
      <ReactMarkdown>{widget.config?.content || ''}</ReactMarkdown>
    </div>
  );
};

export default MarkdownWidget; 