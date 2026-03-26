import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import Layout from "@/components/layout/Layout";
import { Toaster } from "sonner";

const PUBLIC_PATHS = ["/login"];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session && !PUBLIC_PATHS.includes(router.pathname)) {
      router.replace("/login");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <span className="loading loading-spinner loading-sm text-base-content/40" />
      </div>
    );
  }

  if (!session && !PUBLIC_PATHS.includes(router.pathname)) return null;

  return <>{children}</>;
}

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <SessionProvider session={session}>
      <AuthGuard>
        <Layout>
          <Component {...pageProps} />
          <Toaster theme="dark" position="bottom-right" />
        </Layout>
      </AuthGuard>
    </SessionProvider>
  );
}
