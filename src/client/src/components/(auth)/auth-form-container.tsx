import { MoveRightIcon } from "lucide-react";
import { GithubIcon } from "lucide-react";
import { Button } from "../ui/button";
import Link from "next/link";

export default function AuthFormContainer({ children }: { children: JSX.Element }) {
  return (<div className="flex flex-col justify-center p-8 lg:p-16">
    <div className="w-full max-w-sm mx-auto space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to OpenLIT</h1>
        <p className="text-muted-foreground">Open Source Platform for AI Engineering</p>
      </div>
      {children}
      <div className="grid grid-cols-2 text-center text-sm">
        <Link href={"https://github.com/openlit/openlit"}
          target="_blank" className="w-full">
          <Button
            className={`w-full rounded-full bg-neutral-900 text-sm font-medium text-white md:text-sm gap-2`}
          >
            Github
            <GithubIcon className="ml-2 w-4" />
          </Button>
        </Link>
        <Link href="https://docs.openlit.io/latest/introduction"
          target="_blank">
          <Button variant={"ghost"}>
            <b>Documentation</b>
            <MoveRightIcon className="ml-2 h-5 w-5" />
          </Button>
        </Link>
        {/* <a

          className={`group relative z-10 flex items-center justify-center space-x-2 rounded-full border border-transparent bg-transparent text-sm font-medium text-black transition duration-200 hover:bg-gray-100 dark:text-white dark:hover:bg-neutral-800 dark:hover:shadow-xl md:text-sm`}
        >

        </a> */}
      </div>
    </div>
  </div>)
}