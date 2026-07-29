import { ReactNode, useCallback } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import TourGate from "@/components/onboarding/TourGate";

const NO_LAYOUT_PATHS = ["/login"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const handleCollapse = useCallback((_c: boolean) => {}, []);

  if (NO_LAYOUT_PATHS.includes(router.pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen overflow-hidden bg-base-100 flex">
      <TourGate />
      <Sidebar onCollapse={handleCollapse} />
      <main className="ml-13 flex-1 p-6 overflow-y-auto transition-[margin] duration-200">{children}</main>
    </div>
  );
}
