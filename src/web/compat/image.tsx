import type { ImgHTMLAttributes } from "react";
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | { src: string }; fill?: boolean; priority?: boolean; quality?: number; unoptimized?: boolean; placeholder?: string; blurDataURL?: string };
export default function Image({ src, fill, priority, quality: _quality, unoptimized: _unoptimized, placeholder: _placeholder, blurDataURL: _blur, style, ...props }: Props) {
  return <img {...props} src={typeof src === "string" ? src : src.src} loading={priority ? "eager" : props.loading ?? "lazy"} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style } : style} />;
}