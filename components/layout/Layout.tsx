import { ReactNode } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";

const NO_LAYOUT_PATHS = ["/login"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();

  if (NO_LAYOUT_PATHS.includes(router.pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-base-100">
      <Sidebar />
      <main className="ml-48 p-6 min-h-screen">{children}</main>
    </div>
  );
}
