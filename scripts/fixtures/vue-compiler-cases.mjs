export const cases = [
  {
    name: 'generic interface',
    script: 'interface Box<T> { value:T; optional?:boolean }; defineProps<Box<string>>()',
    props: ['value', 'optional'],
  },
  {
    name: 'interface heritage',
    script: 'interface Base<T> { value:T }; interface Props extends Base<number> { label:string }; defineProps<Props>()',
    props: ['value', 'label'],
  },
  {
    name: 'generic type alias',
    script: 'type Box<T> = { value:T }; defineProps<Box<boolean>>()',
    props: ['value'],
  },
  {
    name: 'utility arguments',
    script: 'type Base = {first:string;second:number}; defineProps<Partial<Pick<Base,"first">>>()',
    props: ['first'],
  },
  {
    name: 'mapped keys',
    script: 'type Props = { [Key in "first"|"second"]: string }; defineProps<Props>()',
    props: ['first', 'second'],
  },
  {
    name: 'mapped template keys',
    script: `type Props = { [Key in "first"|"second" as \`get_\${Key}\`]: number }; defineProps<Props>()`,
    props: ['get_first', 'get_second'],
  },
  {
    name: 'template indexed keys',
    script: `type Keys = \`item_\${"one"|"two"}\`; type Props = {[Name in Keys]:string}; defineProps<Props>()`,
    props: ['item_one', 'item_two'],
  },
  {
    name: 'enum values',
    script: 'enum Choice { First="first", Second=2 }; defineProps<{choice:Choice}>()',
    props: ['choice'],
  },
  {
    name: 'merged enum',
    script: 'enum Choice { First=1 }; enum Choice { Second=2 }; defineProps<{choice:Choice}>()',
    props: ['choice'],
  },
  {
    name: 'qualified namespace',
    script: 'namespace Outer.Inner { export interface Props { label:string } }; defineProps<Outer.Inner.Props>()',
    props: ['label'],
  },
  {
    name: 'global namespace',
    script: 'declare global { interface Props { label:string } }; defineProps<Props>()',
    props: ['label'],
  },
  {
    name: 'function emits',
    script: 'defineEmits<(event:"save"|"cancel", value:number)=>void>()',
    emits: ['save', 'cancel'],
  },
  {
    name: 'interface call emits',
    script: 'interface Events { (event:"save", value:number):void; (event:"cancel"):void }; defineEmits<Events>()',
    emits: ['save', 'cancel'],
  },
  {
    name: 'named tuple emits',
    script: 'defineEmits<{save:[value:number];cancel:[]}>()',
    emits: ['save', 'cancel'],
  },
  {
    name: 'return type props',
    script: 'type Factory = () => {label:string}; defineProps<ReturnType<Factory>>()',
    props: ['label'],
  },
  {
    name: 'generic model',
    script: 'const model = defineModel<string>({required:true})',
    props: ['modelValue', 'modelModifiers'],
    emits: ['update:modelValue'],
  },
  { name: 'typed slots', script: 'defineSlots<{default(props:{label:string}):unknown}>()' },
  {
    name: 'generic mapped property',
    script: 'type Box<T> = {[Key in keyof T]:T[Key]}; defineProps<{box:Box<{label:string;count:number}>}>()',
    props: ['box'],
  },
]

export function sourceFor(fixture) {
  return `<script setup lang="ts">${fixture.script}</script><template><div>fixture</div></template>`
}

export const interactiveSource = '<script setup lang="ts">import {ref} from "vue"; interface Props<T> {label:T}; const props=defineProps<Props<string>>(); const emit=defineEmits<(event:"change",value:number)=>void>(); const count=ref<number>(0); function increment(){count.value++;emit("change",count.value)}</script><template><button id="counter" @click="increment">{{props.label}}:{{count}}</button></template><style scoped>button{color:red}</style>'
