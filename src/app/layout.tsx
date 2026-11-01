import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClusterProvider } from "@/components/cluster-provider";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nimbus Cluster — Distributed Systems Lab",
  description:
    "TCP messaging, UDP notifications, file sharing, Round Robin, Berkeley clock sync, Ricart-Agrawala, deadlock detection and MapReduce on a live virtual cluster.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ClusterProvider>
          <Shell>{children}</Shell>
        </ClusterProvider>
      </body>
    </html>
  );
}
