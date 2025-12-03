import React from 'react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';

export default function ExperimentsGettingStarted() {
  return (
    <div className="flex flex-col items-center p-8">
      <div className="max-w-4xl w-full">
        <h1 className="text-3xl font-semibold text-center mb-6 text-stone-800 dark:text-stone-200">
          Get Started with OpenGround
        </h1>
        <p className="text-center text-md mb-12 text-stone-500 dark:text-stone-500">
          Experiment and test different LLM configurations, prompts, and parameters.
          Compare outputs side-by-side to find the optimal setup for your use case.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[{
            icon: "🔬",
            title: "Test Configurations",
            description: "Experiment with different LLM models, parameters, and settings to find the best configuration for your specific use case.",
          },
          {
            icon: "🔄",
            title: "Compare Results",
            description: "View outputs from different configurations side-by-side to make informed decisions about your LLM setup.",
          },
          {
            icon: "📝",
            title: "Prompt Testing",
            description: "Test and refine your prompts iteratively to achieve better results and more accurate AI responses.",
          },
          {
            icon: "⚡",
            title: "Quick Iteration",
            description: "Rapidly test multiple variations to optimize your LLM application before deploying to production.",
          }
          ].map((item) => (
            <Card className='border'>
              <CardTitle className='p-6 gap-2 flex items-center text-stone-700 dark:text-stone-300'>
                <span className="text-2xl">{item.icon}</span>
                <span>{item.title}</span>
              </CardTitle>
              <CardContent>
                <p className="text-stone-500 dark:text-stone-400">
                  {item.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
