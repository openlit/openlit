import React from 'react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';

export default function SecretsGettingStarted() {
  return (
    <div className="flex flex-col items-center p-8">
      <div className="max-w-4xl w-full">
        <h1 className="text-3xl font-semibold text-center mb-6 text-stone-800 dark:text-stone-200">
          Get Started with Vault
        </h1>
        <p className="text-center text-md mb-12 text-stone-500 dark:text-stone-500">
          Securely store and access sensitive information including LLM API keys and credentials.
          Access your secrets through authenticated API endpoints with full audit tracking.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[{
            icon: "🔒",
            title: "Secure Storage",
            description: "Store LLM API keys and sensitive credentials securely with encryption and access controls.",
          },
          {
            icon: "🔑",
            title: "API Access",
            description: "Access your secrets through authenticated API endpoints for seamless integration with your applications.",
          },
          {
            icon: "👤",
            title: "User Tracking",
            description: "Track who created and updated each secret for complete accountability and transparency.",
          },
          {
            icon: "⏰",
            title: "Update History",
            description: "Monitor when secrets were last updated to ensure your credentials remain current and secure.",
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
