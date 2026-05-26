import { Fragment } from 'react';
import { AnimatePresence as FramerAnimatePresence, motion as framerMotion } from 'framer-motion';
import { isAndroidWebView } from './platform';

const MOTION_ONLY_PROPS = new Set([
  'animate',
  'custom',
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
  'exit',
  'initial',
  'layout',
  'layoutDependency',
  'layoutId',
  'transition',
  'variants',
  'viewport',
  'whileDrag',
  'whileFocus',
  'whileHover',
  'whileInView',
  'whileTap',
]);

const safeComponents = new Map();

function stripMotionProps(props) {
  const cleanProps = {};

  for (const [key, value] of Object.entries(props)) {
    if (MOTION_ONLY_PROPS.has(key)) continue;
    if (key.startsWith('onAnimation')) continue;
    if (key.startsWith('onUpdate')) continue;

    if (key === 'style' && value && typeof value === 'object') {
      const style = { ...value };
      if (style.overflow === 'hidden') delete style.overflow;
      cleanProps.style = style;
      continue;
    }

    cleanProps[key] = value;
  }

  return cleanProps;
}

function createSafeMotionComponent(tag) {
  const FramerComponent = framerMotion[tag];

  function SafeMotionComponent(props) {
    if (isAndroidWebView()) {
      const Element = tag;
      return <Element {...stripMotionProps(props)} />;
    }

    return <FramerComponent {...props} />;
  }

  SafeMotionComponent.displayName = `SafeMotion.${tag}`;
  return SafeMotionComponent;
}

export function AnimatePresence({ children, ...props }) {
  if (isAndroidWebView()) {
    return <Fragment>{children}</Fragment>;
  }

  return <FramerAnimatePresence {...props}>{children}</FramerAnimatePresence>;
}

export const motion = new Proxy(framerMotion, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    if (!safeComponents.has(prop)) {
      safeComponents.set(prop, createSafeMotionComponent(prop));
    }
    return safeComponents.get(prop);
  },
});
