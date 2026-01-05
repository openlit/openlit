import React from 'react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import PromptHubHeader from '../../prompt-hub/header';

export default function PromptsGettingStarted() {
  return (
    <div className="flex flex-col items-center p-8">
      <div className="max-w-4xl w-full">
        <h1 className="text-3xl font-semibold text-center mb-6 text-stone-800 dark:text-stone-200">
          Get Started with Prompt Hub
        </h1>
        <p className="text-center text-md mb-6 text-stone-500 dark:text-stone-500">
          Centralized prompt management system to version, deploy, and collaborate on prompts.
          Track prompt usage, manage variables, and easily retrieve prompts across your applications.
        </p>
        <PromptHubHeader createNew className="grid grid-cols-2 w-full items-center justify-center gap-6 mb-8 [&>*:first-child]:justify-self-end [&>*:nth-child(2)]:justify-self-start" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[{
            icon: "📝",
            title: "Version Control",
            description: "Track and manage different versions of your prompts with complete version history and rollback capabilities.",
          },
          {
            icon: "🔄",
            title: "Variable Support",
            description: "Create dynamic prompts with variable placeholders for flexible and reusable prompt templates.",
          },
          {
            icon: "👥",
            title: "Team Collaboration",
            description: "Collaborate with your team on prompt development and track who created and modified prompts.",
          },
          {
            icon: "📊",
            title: "Usage Tracking",
            description: "Monitor prompt downloads and usage across your applications to understand which prompts are most valuable.",
          }
          ].map((item) => (
            <Card className='border' key={item.title}>
              <CardTitle className='p-6 gap-2 flex items-center text-stone-700 dark:text-stone-300 text-xl'>
                <span>{item.icon}</span>
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
