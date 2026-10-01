'use client'

import { Eye, EyeOff, Lock } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { Input, InputAction } from './form'

/** Password field with a lock icon and a show/hide toggle. */
export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      type={visible ? 'text' : 'password'}
      icon={Lock}
      trailing={
        <InputAction
          icon={visible ? EyeOff : Eye}
          label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
        />
      }
      {...props}
    />
  )
}
