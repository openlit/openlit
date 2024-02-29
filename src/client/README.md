## Run Doku UI Client server
![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white) ![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white) ![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white) ![Clickhouse](https://img.shields.io/badge/clickhouse-faff69?style=for-the-badge&logo=clickhouse
) ![Headless](https://img.shields.io/badge/headlessui-6dc0fd?style=for-the-badge&logo=headlessui
) ![Next-Auth](https://img.shields.io/badge/next-auth-2cfefe?style=for-the-badge&logo=next-auth
)

Doku Client frontend uses Nextjs, Typescript and Tailwind. The application uses `@tremor/react` for charts, `react-hot-toast` for toasts, `@clickhouse/client` for clickhouse db client, `@prisma/client` for client's db for user management, db configuration management etc.

# 📖 Table of Contents
- [⚙️ Pre-requisites](#-pre-requisites)
- [📌 The first step : Setup server without docker](#-the-first-step--setup-server-without-docker)
- [🔌 Found a bug or want to request a feature](#found-a-bug-or-want-to-request-a-feature)
- [Give A Star ⭐](#give-a-star-)

### Pre-requisites:
- `node` : version >=20
- `postgres` : db for the doku client's storage (this comes under docker compose but if you setup without docker, then you need postgres db url to be set in env variable)
 
### The first step : Setup server without docker
1. Clone the doku repository 
    ```sh 
    git clone git@github.com:dokulabs/doku.git
    ````
2. Go to the client folder
    ```sh 
    cd src/client
    ````
3. Install the dependencies
    ```sh 
    npm install
    ````
4. Run command below to create an env file and then update the .env file for the `DATABASE_URL` to point to the postgres db
    ```sh 
    cp .env.example .env
    ````
5. Apply the migrations to the postgres db using the below commands. First command applies the migrations to the db and the second command generates assets like Prisma Client based on the generator and data model blocks defined in your prisma/schema.prisma file.
    ```sh 
    npx prisma migrate deploy
    npx prisma generate
    ````
6. Start the dev server
    ```sh 
    npm run dev
    ````

### Found a bug or want to request a feature

Please open a [Github issue](https://github.com/dokulabs/doku/issues/new/choose).

### Give A Star ⭐

You can also give this repository a star to show more people and they can use this repository