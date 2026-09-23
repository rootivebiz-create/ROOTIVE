import type { Metadata } from "next";
import { JsonLd, faqPageLd } from "@/components/json-ld";
import { BusinessInfo } from "@/components/landing/business-info";
import { Deadlines } from "@/components/landing/deadlines";
import { Enough } from "@/components/landing/enough";
import { Faq, landingFaq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Flow } from "@/components/landing/flow";
import { Hero } from "@/components/landing/hero";
import { Maker } from "@/components/landing/maker";
import { Pains } from "@/components/landing/pains";
import { Pricing } from "@/components/landing/pricing";
import { Trust } from "@/components/landing/trust";
import { regNoText } from "@/lib/format";
import { CONTACT, PLANS, SHARE_IMAGE, SITE, businessInfo, type BusinessInfo as Info } from "@/site.config";

const OG_TITLE = `${SITE.name}｜${SITE.tagline}`;

export const metadata: Metadata = {
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: SITE.locale,
    siteName: SITE.name,
    url: "/",
    title: OG_TITLE,
    description: SITE.description,
    images: [SHARE_IMAGE],
  },
};

/** 事業者の構造化データ。設定されている項目だけを入れる（無い情報は作らない） */
function businessLd(info: Info) {
  const url = `${SITE.url}/`;
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${url}#business`,
    name: SITE.name,
    url,
    description: SITE.description,
    areaServed: { "@type": "Country", name: "日本" },
    serviceType:
      "軽貨物・運送会社向けの月末の締めの仕組み（Excelの取り込み・支払明細とドライバーの確認・振込データ・元請の支払通知との突き合わせ）の立ち上げと保守",
    ...(info.ownerName ? { founder: { "@type": "Person", name: info.ownerName } } : {}),
    ...(info.address ? { address: info.address } : {}),
    ...(info.phone ? { telephone: info.phone } : {}),
    ...(CONTACT.email ? { email: CONTACT.email } : {}),
    ...(info.invoiceRegNo ? { taxID: regNoText(info.invoiceRegNo) } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "料金（税抜）",
      itemListElement: PLANS.map((p) => ({
        "@type": "Offer",
        name: p.name,
        description: p.forWhom,
        priceCurrency: "JPY",
        price: p.initialYen,
        priceSpecification: [
          {
            "@type": "PriceSpecification",
            name: p.monthlyYen > 0 ? "初期費用" : "費用",
            price: p.initialYen,
            priceCurrency: "JPY",
            valueAddedTaxIncluded: false,
          },
          ...(p.monthlyYen > 0
            ? [
                {
                  "@type": "UnitPriceSpecification",
                  name: "月額",
                  price: p.monthlyYen,
                  priceCurrency: "JPY",
                  unitCode: "MON",
                  valueAddedTaxIncluded: false,
                },
              ]
            : []),
        ],
      })),
    },
  };
}

export default function HomePage() {
  const info = businessInfo();
  const faq = landingFaq();

  return (
    <>
      <JsonLd data={businessLd(info)} />
      <JsonLd data={faqPageLd(faq)} />
      <Hero />
      <Pains />
      <Deadlines />
      <Features />
      <Enough />
      <Maker />
      <Pricing invoiceRegNo={info.invoiceRegNo} />
      <Trust />
      <Flow />
      <Faq items={faq} />
      <BusinessInfo info={info} email={CONTACT.email} />
      <FinalCta bookingUrl={CONTACT.bookingUrl} lineUrl={CONTACT.lineUrl} />
    </>
  );
}
