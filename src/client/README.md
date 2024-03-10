## Run Doku UI Client server

[![Doku](https://img.shields.io/badge/Doku-orange)](https://github.com/dokulabs/doku)
[![License](https://img.shields.io/github/license/dokulabs/doku?label=license&logo=github&color=f80&logoColor=fff%22%20alt=%22License)](https://github.com/dokulabs/doku/blob/main/LICENSE)
[![Client Version](https://img.shields.io/github/tag/dokulabs/doku.svg?label=Version&logo=next.js)](https://github.com/dokulabs/doku/tags)

![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white) 
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white) 
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white) 
![Clickhouse](https://img.shields.io/badge/clickhouse-faff69?style=for-the-badge&logo=clickhouse)
![Headless](https://img.shields.io/badge/headlessui-6dc0fd?style=for-the-badge&logo=headlessui)
![Next-Auth](https://img.shields.io/badge/next-auth-2cfefe?style=for-the-badge&logo=next-auth)

Doku Client serves as the frontend UI for displaying visualizations and observability data for Large Language Models (LLM), drawing data from ClickHouse. The platform leverages the power of modern web technologies like Next.js and TailwindCSS to offer an intuitive and responsive user experience.

## Features

- **Rich Analytics Dashboard**: Visualize LLM performance, usage patterns, and cost metrics in real-time.
- **User Management**: Integrated user management for access control and authentication.
- **Flexible Data Source Integration**: Built-in support for ClickHouse, enabling efficient data retrieval and management.
- **Responsive Design**: A UI that adapts to various screen sizes, providing an optimal viewing experience across devices.

## Quick Start

Follow the steps below to get Doku Client running in your environment. Both Docker and manual installation options are provided.


### Docker

1. **Pull the Docker image**
    ```bash
    docker pull ghcr.io/dokulabs/doku-client:latest
    ```

2. **Run the container with Environment Variables**
    Here, replace `<YourValues>` with actual values for the environment variables.
    ```bash
    docker run -d -p 3000:3000 \
    -e INIT_DB_HOST="<ClickHouse-URL>" \
    -e INIT_DB_PORT="<ClickHouse-Port>" \
    -e INIT_DB_DATABASE="<ClickHouse-Database-name>" \
    -e INIT_DB_USERNAME="<ClickHouse-username>" \
    -e INIT_DB_PASSWORD="<ClickHouse-password>" \
    -e SQLITE_DATABASE_URL=file:/app/client/data/data.db \
    --name doku_client doku-client
    ```

You can also use the [Doku Helm Chart](www.github.com/dokulabs/helm) to deploy Doku Client in Kubernetes

### Manual Setup (Development)

1. **Clone the doku repository**
    ```sh
    git clone https://github.com/dokulabs/doku.git
    ```
2. **Navigate to the client folder**
    ```sh
    cd doku/src/client
    ```
3. **Install the dependencies**
    ```sh
    npm install
    ```
4. **Configure Environemnt Variables**

    Below are the commands to set environment variables if needed during manual setup. Replace `<value>` with your actual configuration:
    ```sh
    export INIT_DB_HOST=<value>
    export INIT_DB_PORT=<value>
    export INIT_DB_DATABASE=<value>
    export INIT_DB_USERNAME=<value>
    export INIT_DB_PASSWORD=<value>
    export SQLITE_DATABASE_URL=<value>
    ```
    
5. **Apply the migrations**
    
    This creates your SQLite database schema.
    ```sh
    npx prisma migrate deploy
    npx prisma generate
    ```
6. **(Optional) Seed the database**
    
    If desired, seed the database to create a default user (`user@dokulabs.com` with the password `dokulabsuser`) and database configuration.
    ```sh
    npx prisma db seed
    ```
    Ensure the database is empty before running this command.

7. **Start the development server**
    ```sh
    npm run dev
    ```

## Configuration

To configure Doku Client, you can pass the following environment values, each tailored to suit your infrastructure and operational preferences. This customization allows Doku Client to seamlessly integrate with your existing setup and respond to its demands effectively.


| Variable             | Description                                                                 | Required | Example                               |
|----------------------|-----------------------------------------------------------------------------|:--------:|---------------------------------------|
| `INIT_DB_HOST`       | Host address of the ClickHouse server to connect to.                        |    ✓     | `127.0.0.1`                           |
| `INIT_DB_PORT`       | Port on which ClickHouse listens.                                           |    ✓     | `8123`                                |
| `INIT_DB_DATABASE`   | Database name in ClickHouse for Doku Client.                                |          | `default`                             |
| `INIT_DB_USERNAME`   | Username for authenticating with ClickHouse.                                |          | `default`                             |
| `INIT_DB_PASSWORD`   | Password for authenticating with ClickHouse.                                |          | `default`                             |
| `SQLITE_DATABASE_URL`| Location of the SQLITE database for Doku Client data storage.                |    ✓     | `file:/app/client/data/data.db`       |

For more detailed information on configuration options and additional settings, please visit the Doku documentation page: [Doku Configuration Details](https://docs.dokulabs.com/latest/configuration).

## Security

We take security seriously. Doku Client incorporates best practices for authentication, authorization, and secure communication to ensure data privacy and protection.

## Contributing

Contributions to Doku Client are greatly appreciated. Whether you have suggestions for bug fixes, improvements, or new features, please see [CONTRIBUTING](https://github.com/dokulabs/doku/CONTRIBUTING) for more details on submitting pull requests or opening issues.

## License

Doku Client is available under the [Apache-2.0 license](https://github.com/dokulabs/doku/LICENSE).

## Support

For support, issues, or feature requests, please submit an issue through the [GitHub issues](https://github.com/dokulabs/doku/issues) page for this repository.