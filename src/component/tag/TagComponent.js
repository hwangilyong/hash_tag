
export default function TagComponent({top, left, cont}) {
    return (
        <span className='tagItem' style={{top, left}}>
            {cont}
        </span>
    )
}