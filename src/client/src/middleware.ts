import { chain } from '@/middleware/chain';
import checkAuth from '@/middleware/check-auth';
import checkDemoAccount from '@/middleware/check-demo-account';


export const middleware = chain([
  checkDemoAccount,
  checkAuth,
]);


export const config = {
  matcher: [
    "/api/:path*",
    "/login",
    "/register",
    "/getting-started",
    "/dashboard",
    "/requests",
    "/database-config",
    "/openground",
    "/exceptions",
    "/prompt-hub",
    "/vault",
    "/api-keys",
  ],
};