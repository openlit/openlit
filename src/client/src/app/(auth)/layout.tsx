import AuthFormContainer from "@/components/(auth)/auth-form-container";
import AutoSignInDemoInstance from "../../components/(auth)/auto-signin-demo-instance";
import CustomPostHogProvider from "@/components/(playground)/posthog";

export default function AuthLayout({
	children,
}: {
	children: JSX.Element;
}) {
	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<AuthFormContainer>
				<AutoSignInDemoInstance demoCreds={{ email: process.env.DEMO_ACCOUNT_EMAIL, password: process.env.DEMO_ACCOUNT_PASSWORD }}>
					{children}
				</AutoSignInDemoInstance>
			</AuthFormContainer>
		</CustomPostHogProvider>
	);
}
