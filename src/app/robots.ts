import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard/", "/admin/", "/admin-panel/", "/login", "/signup"],
    },
    sitemap: "https://chatnexgen.online/sitemap.xml",
  };
}
