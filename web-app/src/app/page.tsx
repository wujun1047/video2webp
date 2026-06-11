import { ConverterForm } from "@/components/converter-form";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#191714]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-2 border-b border-[#d8d1c3] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#766d5f]">
              Video2WebP
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
              视频转透明 WebP
            </h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#6f6658]">
            支持绿幕和蓝幕素材。单个视频 50 MB 内，最长 8 秒，最大输出边长 720px。
          </p>
        </header>

        <ConverterForm />
      </div>
    </main>
  );
}
